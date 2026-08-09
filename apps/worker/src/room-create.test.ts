import { describe, expect, it } from "vitest";
import { authorizeRoomCreate, timingSafeEqual } from "./room-create";

describe("timingSafeEqual", () => {
  it("returns true for identical strings", () => {
    expect(timingSafeEqual("supersecret", "supersecret")).toBe(true);
  });

  it("returns false for different strings of equal length", () => {
    expect(timingSafeEqual("abc", "abd")).toBe(false);
  });

  it("returns false for strings of different length", () => {
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
  });

  it("returns false for the empty string vs a value", () => {
    expect(timingSafeEqual("", "a")).toBe(false);
  });
});

describe("authorizeRoomCreate", () => {
  const SECRET = "room-secret";

  it("authorizes a request with the exact Bearer token", () => {
    expect(authorizeRoomCreate(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it("rejects when the Authorization header is missing", () => {
    expect(authorizeRoomCreate(null, SECRET)).toBe(false);
  });

  it("rejects when the header is not a Bearer token", () => {
    expect(authorizeRoomCreate(`Basic ${SECRET}`, SECRET)).toBe(false);
    expect(authorizeRoomCreate(SECRET, SECRET)).toBe(false);
  });

  it("rejects a mismatched bearer token", () => {
    expect(authorizeRoomCreate("Bearer wrong-secret", SECRET)).toBe(false);
  });

  it("rejects when the server has no secret configured (fail closed)", () => {
    expect(authorizeRoomCreate(`Bearer ${SECRET}`, undefined)).toBe(false);
    expect(authorizeRoomCreate(`Bearer ${SECRET}`, "")).toBe(false);
  });
});
