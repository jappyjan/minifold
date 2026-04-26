import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Markdown } from "@/components/browse/Markdown";

describe("Markdown", () => {
  it("renders headings, paragraphs, and lists", () => {
    const { container } = render(
      <Markdown source={"# Title\n\nHello *world*\n\n- a\n- b\n"} />,
    );
    expect(container.querySelector("h1")?.textContent).toBe("Title");
    expect(container.querySelector("em")?.textContent).toBe("world");
    expect(container.querySelectorAll("li").length).toBe(2);
  });

  it("renders GFM tables", () => {
    const md = "| h1 | h2 |\n|----|----|\n| a  | b  |\n";
    const { container } = render(<Markdown source={md} />);
    expect(container.querySelector("table")).toBeInTheDocument();
    expect(container.querySelectorAll("td").length).toBe(2);
  });

  it("strips <script> tags via sanitization", () => {
    const md = "Hello\n\n<script>alert(1)</script>\n";
    const { container } = render(<Markdown source={md} />);
    expect(container.querySelector("script")).toBeNull();
  });

  it("strips javascript: URLs in links", () => {
    const md = "[click](javascript:alert(1))";
    const { container } = render(<Markdown source={md} />);
    const a = container.querySelector("a");
    // rehype-sanitize either drops the href or replaces it; both are acceptable
    expect(a?.getAttribute("href") ?? "").not.toContain("javascript:");
  });
});
