import { extractCommentBody, extractReplyToken } from "./inbound-email";

describe("extractReplyToken", () => {
  it("extracts the token from a bare address", () => {
    expect(extractReplyToken("ticket+abc123@inbound.example.com")).toBe("abc123");
  });

  it("extracts the token from a \"Name <addr>\" form", () => {
    expect(extractReplyToken("Support <ticket+abc-123@inbound.example.com>")).toBe("abc-123");
  });

  it("returns null when the address doesn't match the ticket+ pattern", () => {
    expect(extractReplyToken("someone@example.com")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(extractReplyToken("")).toBeNull();
  });
});

describe("extractCommentBody", () => {
  it("prefers text over html", () => {
    expect(extractCommentBody({ text: "Plain reply", html: "<p>HTML reply</p>" })).toBe("Plain reply");
  });

  it("falls back to a stripped html body when text is absent", () => {
    expect(extractCommentBody({ html: "<p>Hello <b>there</b></p>" })).toBe("Hello there");
  });

  it("decodes common HTML entities when stripping", () => {
    expect(extractCommentBody({ html: "<p>Tom &amp; Jerry &lt;3&gt;</p>" })).toBe("Tom & Jerry <3>");
  });

  it("truncates a body longer than 10000 characters", () => {
    const body = extractCommentBody({ text: "a".repeat(10050) });
    expect(body).toHaveLength(10000);
  });

  it("returns null when both text and html are absent", () => {
    expect(extractCommentBody({})).toBeNull();
  });

  it("returns null when text is whitespace-only and html is absent", () => {
    expect(extractCommentBody({ text: "   " })).toBeNull();
  });

  it("returns null when html strips down to nothing", () => {
    expect(extractCommentBody({ html: "<div><br/></div>" })).toBeNull();
  });
});
