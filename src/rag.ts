import {
  ChatMessage,
  ChatResult,
  CompiledGraph,
  JsonObject,
  LLMProvider,
  autoModel,
  createGraph,
} from "@langgraph-toolkit/core";

/** A JSON-safe retrieved document with one canonical text field. */
export interface RAGDocument extends JsonObject {
  readonly content: string;
}

/** Retrieval controls passed from the RAG facade to an injected retriever. */
export interface RAGRetrieveOptions {
  readonly topK?: number;
  readonly signal?: AbortSignal;
}

/** Generic retrieval boundary for vector, keyword, graph, file, or remote stores. */
export interface RAGRetriever<TDocument extends RAGDocument = RAGDocument> {
  retrieve(query: string, options?: RAGRetrieveOptions): Promise<readonly TDocument[]>;
}

/** Per-call controls for a grounded answer. */
export interface RAGAnswerOptions {
  readonly topK?: number;
  readonly signal?: AbortSignal;
}

/** The typed result returned by rag.answer(). */
export interface RAGAnswer<TDocument extends RAGDocument = RAGDocument> {
  readonly query: string;
  readonly answer: string;
  readonly documents: readonly TDocument[];
  readonly response: ChatResult;
}

/** Construction options for a provider-neutral RAG facade. */
export interface RAGOptions<TDocument extends RAGDocument = RAGDocument> {
  readonly retriever?: RAGRetriever<TDocument>;
  readonly model?: LLMProvider;
  readonly name?: string;
  readonly topK?: number;
  readonly system?: string;
}

/** A generic RAG workflow that can answer directly or plug into a Core graph. */
export interface RAG<TDocument extends RAGDocument = RAGDocument> {
  answer(query: string, options?: RAGAnswerOptions): Promise<RAGAnswer<TDocument>>;
  asSubgraph(): CompiledGraph<RAGState<TDocument>, Partial<RAGState<TDocument>>, RAGState<TDocument>>;
}

/** State contract exposed by the RAG subgraph. */
export interface RAGState<TDocument extends RAGDocument = RAGDocument> {
  readonly query: string;
  readonly documents: readonly TDocument[];
  readonly answer: string;
}

function createMessages(query: string, documents: readonly RAGDocument[], system: string): readonly ChatMessage[] {
  const context = documents.length === 0
    ? "No retrieved context was available. Say that the evidence is insufficient instead of inventing facts."
    : documents.map((document, index) => `[${index + 1}] ${document.content}`).join("\n\n");
  return [
    { role: "system", content: system },
    { role: "user", content: `Context:\n${context}\n\nQuestion:\n${query}` },
  ];
}

function limitDocuments<TDocument extends RAGDocument>(documents: readonly TDocument[], topK: number | undefined): readonly TDocument[] {
  return topK === undefined ? documents : documents.slice(0, topK);
}

/** Create a provider-neutral RAG implementation with zero-config model and retriever defaults. */
export function createRAG<TDocument extends RAGDocument = RAGDocument>(options: RAGOptions<TDocument> = {}): RAG<TDocument> {
  const retriever: RAGRetriever<TDocument> = options.retriever ?? {
    retrieve: async (): Promise<readonly TDocument[]> => [],
  };
  const model = options.model ?? autoModel();
  const topK = options.topK === undefined ? 5 : Math.max(1, options.topK);
  const system = options.system ?? "Answer using only the supplied context. If the context is insufficient, say so clearly.";

  const answer = async (query: string, answerOptions: RAGAnswerOptions = {}): Promise<RAGAnswer<TDocument>> => {
    const documents = limitDocuments(await retriever.retrieve(query, { topK: answerOptions.topK ?? topK, signal: answerOptions.signal }), answerOptions.topK ?? topK);
    const response = await model.chat(createMessages(query, documents, system), { signal: answerOptions.signal });
    return { query, answer: response.content, documents, response };
  };

  const asSubgraph = (): CompiledGraph<RAGState<TDocument>, Partial<RAGState<TDocument>>, RAGState<TDocument>> => {
    const graph = createGraph({
      name: options.name ?? "rag",
      state: { query: "", documents: [] as readonly TDocument[], answer: "" },
    })
      .node("retrieve", async (state) => ({ documents: await retriever.retrieve(state.query, { topK }) }))
      .node("answer", async (state) => {
        const result = await answer(state.query, { topK });
        return { answer: result.answer };
      })
      .edge("retrieve", "answer")
      .start("retrieve");
    return graph.build();
  };

  return { answer, asSubgraph };
}
