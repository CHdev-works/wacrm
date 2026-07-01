import { describe, expect, it } from "vitest";
import {
  isValidElement,
  type MouseEventHandler,
  type ReactNode,
  type ReactElement,
} from "react";
import { linkify } from "./linkify";

// ---- tiny tree helpers (node env — no DOM / renderer needed) ----------

interface AnchorProps {
  href: string;
  target?: string;
  rel?: string;
  title?: string;
  onClick?: MouseEventHandler;
  children?: ReactNode;
}

function toArray(node: ReactNode): ReactNode[] {
  if (Array.isArray(node)) return node as ReactNode[];
  return [node];
}

/** All `<a>` host elements produced for a piece of text. */
function anchors(node: ReactNode): ReactElement<AnchorProps>[] {
  return toArray(node).filter(
    (n): n is ReactElement<AnchorProps> =>
      isValidElement(n) && n.type === "a",
  );
}

/** Recursively collect visible text from any node (ignores the icon). */
function textOf(node: ReactNode): string {
  if (node == null || node === false || node === true) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) {
    const el = node as ReactElement<{ children?: ReactNode }>;
    return textOf(el.props.children);
  }
  return "";
}

describe("linkify — basic linking", () => {
  it("links a single https URL", () => {
    const a = anchors(linkify("visit https://cableshouse.com today"));
    expect(a).toHaveLength(1);
    expect(a[0].props.href).toBe("https://cableshouse.com");
  });

  it("links a single http URL", () => {
    const a = anchors(linkify("http://example.com"));
    expect(a).toHaveLength(1);
    expect(a[0].props.href).toBe("http://example.com");
  });

  it("prefixes www. hosts with https:// but keeps the visible text", () => {
    const out = linkify("see www.cableshouse.com");
    const a = anchors(out);
    expect(a[0].props.href).toBe("https://www.cableshouse.com");
    // Visible text stays exactly as typed.
    expect(textOf(a[0])).toBe("www.cableshouse.com");
  });

  it("handles multiple URLs in one message", () => {
    const a = anchors(
      linkify("a https://one.com b http://two.com c www.three.com"),
    );
    expect(a.map((x) => x.props.href)).toEqual([
      "https://one.com",
      "http://two.com",
      "https://www.three.com",
    ]);
  });

  it("preserves query and fragment in the href", () => {
    const a = anchors(linkify("go https://x.com/p?a=1&b=2#frag now"));
    expect(a[0].props.href).toBe("https://x.com/p?a=1&b=2#frag");
  });
});

describe("linkify — trailing punctuation", () => {
  it("excludes a trailing period from the link", () => {
    const out = linkify("open https://example.com.");
    const a = anchors(out);
    expect(a[0].props.href).toBe("https://example.com");
    // The '.' survives as plain text after the link.
    expect(textOf(out)).toBe("open https://example.com.");
  });

  it.each([",", ";", ")", "]", '"', "!"])(
    "trims a trailing %s",
    (punct) => {
      const a = anchors(linkify(`x https://example.com${punct} y`));
      expect(a[0].props.href).toBe("https://example.com");
    },
  );

  it("keeps a balanced closing paren inside the URL", () => {
    const a = anchors(linkify("https://en.wikipedia.org/wiki/Foo_(bar)"));
    expect(a[0].props.href).toBe("https://en.wikipedia.org/wiki/Foo_(bar)");
  });
});

describe("linkify — false positives are NOT linked", () => {
  it.each([
    "call me on example.com",
    "phone +971 55 123 4567",
    "order #12345 shipped",
    "pi is 3.14159",
    "attached report.pdf",
    "domain.co without scheme",
  ])("does not link %j", (text) => {
    expect(anchors(linkify(text))).toHaveLength(0);
  });
});

describe("linkify — unsafe schemes rejected", () => {
  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>bad()</script>",
    "vbscript:msgbox",
    "file:///etc/passwd",
  ])("does not link %j", (text) => {
    expect(anchors(linkify(text))).toHaveLength(0);
  });
});

describe("linkify — formatting preserved", () => {
  it("preserves newlines and emoji around a link", () => {
    const input = "line1\nline2 https://a.com 🎉\nbye";
    const out = linkify(input);
    // Full round-trip: strings + link text reconstruct the original.
    expect(textOf(out)).toBe(input);
    expect(anchors(out)).toHaveLength(1);
  });

  it("returns empty/undefined text untouched", () => {
    expect(linkify("")).toBe("");
    expect(linkify(null)).toBeNull();
    expect(linkify(undefined)).toBeNull();
  });

  it("leaves link-free text as-is (no anchors)", () => {
    const out = linkify("just a normal message");
    expect(anchors(out)).toHaveLength(0);
    expect(textOf(out)).toBe("just a normal message");
  });
});

describe("linkify — every anchor is a safe new-tab link", () => {
  it("sets target=_blank and rel=noopener noreferrer", () => {
    const a = anchors(
      linkify("a https://one.com and www.two.com end"),
    );
    expect(a).toHaveLength(2);
    for (const anchor of a) {
      expect(anchor.props.target).toBe("_blank");
      expect(anchor.props.rel).toBe("noopener noreferrer");
      expect(typeof anchor.props.onClick).toBe("function");
    }
  });

  it("never throws on adversarial input", () => {
    const nasty = "((((" + "https://".repeat(50) + "))))" + ")))]]]...";
    expect(() => linkify(nasty)).not.toThrow();
    expect(() => linkify("www." + "a".repeat(5000))).not.toThrow();
  });
});
