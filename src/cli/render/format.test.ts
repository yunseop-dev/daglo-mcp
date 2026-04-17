import { describe, it, expect, vi, beforeEach } from "vitest";
import { writeJson, writeKeyValue, writeFilesWritten } from "./format.js";

let stdout: string;
let stderr: string;

beforeEach(() => {
  stdout = "";
  stderr = "";
  vi.spyOn(process.stdout, "write").mockImplementation((c: any) => {
    stdout += String(c);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((c: any) => {
    stderr += String(c);
    return true;
  });
});

describe("writeJson", () => {
  it("writes formatted JSON to stdout with newline", () => {
    writeJson({ a: 1 });
    expect(stdout).toBe('{\n  "a": 1\n}\n');
  });
});

describe("writeKeyValue", () => {
  it("writes key: value lines to stdout", () => {
    writeKeyValue([
      ["ID", "abc"],
      ["Name", "Test"],
    ]);
    expect(stdout).toContain("ID");
    expect(stdout).toContain("abc");
    expect(stdout).toContain("Name");
    expect(stdout).toContain("Test");
  });
});

describe("writeFilesWritten", () => {
  it("writes file paths to stderr with check marks and stdout summary", () => {
    writeFilesWritten(["/tmp/a", "/tmp/b"]);
    expect(stderr).toContain("/tmp/a");
    expect(stderr).toContain("/tmp/b");
  });
});
