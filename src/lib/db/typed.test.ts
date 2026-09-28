import { describe, it, expect, vi } from "vitest";
import { queryOne, queryMany, DbError, type Queryable } from "./typed";

type FakeRow = { id: string; value: number };

function makeFakeQueryable(
  rows: FakeRow[],
  opts?: { throwOn?: RegExp },
): Queryable & { calls: { sql: string; params?: unknown[] }[] } {
  const calls: { sql: string; params?: unknown[] }[] = [];
  // Cast to `as unknown as Queryable["query"]` because the real pg query
  // returns a full QueryResult with command/rowCount/oid/fields; the fake
  // only needs to surface `rows` for the helper code paths under test.
  const fakeQuery = vi.fn(async (...args: unknown[]) => {
    const [sql, params] = args as [string, unknown[]?];
    calls.push({ sql, params });
    if (opts?.throwOn?.test(sql)) {
      throw new Error("connection refused");
    }
    return { rows };
  }) as unknown as Queryable["query"];
  return { calls, query: fakeQuery };
}

describe("queryOne / queryMany — typed DB helpers", () => {
  describe("queryOne", () => {
    it("returns the first row cast to T", async () => {
      const fake = makeFakeQueryable([{ id: "row-1", value: 42 }]);
      const row = await queryOne<FakeRow>(fake, "SELECT id, value FROM t");
      expect(row).toEqual({ id: "row-1", value: 42 });
    });

    it("returns null when the result set is empty", async () => {
      const fake = makeFakeQueryable([]);
      const row = await queryOne<FakeRow>(fake, "SELECT id FROM t WHERE 1=0");
      expect(row).toBeNull();
    });

    it("forwards params to pg", async () => {
      const fake = makeFakeQueryable([{ id: "x", value: 1 }]);
      await queryOne<FakeRow>(fake, "SELECT * FROM t WHERE id = $1", ["x"]);
      expect(fake.calls[0]).toEqual({
        sql: "SELECT * FROM t WHERE id = $1",
        params: ["x"],
      });
    });

    it("wraps pg failures in DbError with the original cause", async () => {
      const fake = makeFakeQueryable([], { throwOn: /^SELECT/ });
      await expect(
        queryOne<FakeRow>(fake, "SELECT * FROM t"),
      ).rejects.toBeInstanceOf(DbError);
      try {
        await queryOne<FakeRow>(fake, "SELECT * FROM t");
      } catch (e) {
        expect(e).toBeInstanceOf(DbError);
        expect((e as DbError).cause).toBeInstanceOf(Error);
        expect(((e as DbError).cause as Error).message).toBe("connection refused");
        expect((e as DbError).message).toBe("queryOne failed");
      }
    });
  });

  describe("queryMany", () => {
    it("returns every row cast to T[]", async () => {
      const fake = makeFakeQueryable([
        { id: "a", value: 1 },
        { id: "b", value: 2 },
        { id: "c", value: 3 },
      ]);
      const rows = await queryMany<FakeRow>(fake, "SELECT * FROM t");
      expect(rows).toHaveLength(3);
      expect(rows[1]).toEqual({ id: "b", value: 2 });
    });

    it("returns an empty array when there are no rows", async () => {
      const fake = makeFakeQueryable([]);
      const rows = await queryMany<FakeRow>(fake, "SELECT * FROM t");
      expect(rows).toEqual([]);
    });

    it("wraps pg failures in DbError", async () => {
      const fake = makeFakeQueryable([], { throwOn: /^SELECT/ });
      await expect(
        queryMany<FakeRow>(fake, "SELECT * FROM t"),
      ).rejects.toBeInstanceOf(DbError);
      try {
        await queryMany<FakeRow>(fake, "SELECT * FROM t");
      } catch (e) {
        expect(e).toBeInstanceOf(DbError);
        expect((e as DbError).message).toBe("queryMany failed");
      }
    });
  });
});