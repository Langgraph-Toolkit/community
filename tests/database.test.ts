import { describe, expect, it } from "vitest";
import { createDatabaseAgent, createDatabaseTools, createMemoryGateway } from "../src/database.js";

describe("database convenience preset", () => {
  it("normalizes rows and enforces query boundaries", async () => {
    const gateway = createMemoryGateway([
      { id: "doc-1", table: "documents", title: "Refund policy", category: "billing" },
      { id: "doc-2", table: "documents", title: "Returns", category: "billing" },
    ]);
    const tools = createDatabaseTools(gateway, {
      server: "database",
      dialect: "memory",
      allowedTables: ["documents"],
      maxRows: 1,
    });
    const toolContext = { threadId: "test-thread", runId: "test-run", variables: {}, global: {} };

    const discovered = await tools.schemaTool.execute({}, toolContext);
    expect(discovered.tables[0]?.columns.map((column) => column.name)).toEqual([
      "id",
      "table",
      "title",
      "category",
    ]);

    const result = await tools.executeQueryTool.execute({
      queryId: "query-1",
      query: "refund",
      table: "documents",
      limit: 10,
      sql: "select * from documents",
    }, toolContext);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.title).toBe("Refund policy");
    await expect(tools.executeQueryTool.execute({
      queryId: "query-2",
      query: "refund",
      table: "users",
      limit: 1,
      sql: "select * from users",
    }, toolContext)).rejects.toThrowError(/not allowed/);
  });

  it("runs the database agent through MCP schema and query tools", async () => {
    const agent = await createDatabaseAgent({
      rows: [
        { id: "course-1", table: "courses", title: "TypeScript", price: 0 },
        { id: "course-2", table: "courses", title: "SQL", price: 35000 },
      ],
      policy: { allowedTables: ["courses"], approvalRequired: false },
    });

    const result = await agent.run({ question: "How many courses are available?" }, { threadId: "community-db-test" });

    expect(result.stoppedReason).toBe("done");
    expect(result.output?.grounded).toBe(true);
    expect(result.output?.rowCount).toBe(2);
    expect(result.state.schema?.tables.map((table) => table.name)).toEqual(["courses"]);
    expect(result.state.audit[0]?.datasource).toBe("database");
    await agent.close();
  });
});
