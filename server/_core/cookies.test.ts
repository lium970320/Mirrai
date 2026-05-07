import { describe, expect, it } from "vitest";
import type { Request } from "express";
import { getSessionCookieOptions } from "./cookies";

function createRequest(
  protocol: string,
  headers: Record<string, string | string[] | undefined> = {}
): Request {
  return {
    protocol,
    headers,
  } as Request;
}

describe("getSessionCookieOptions", () => {
  it("uses a browser-accepted cookie for local HTTP development", () => {
    expect(getSessionCookieOptions(createRequest("http"))).toMatchObject({
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: false,
    });
  });

  it("uses SameSite=None only for HTTPS requests", () => {
    expect(getSessionCookieOptions(createRequest("https"))).toMatchObject({
      sameSite: "none",
      secure: true,
    });
  });

  it("trusts x-forwarded-proto when running behind an HTTPS proxy", () => {
    expect(
      getSessionCookieOptions(
        createRequest("http", { "x-forwarded-proto": "http, https" })
      )
    ).toMatchObject({
      sameSite: "none",
      secure: true,
    });
  });
});
