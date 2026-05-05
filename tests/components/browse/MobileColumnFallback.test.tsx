import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MobileColumnFallback } from "@/components/browse/MobileColumnFallback";

describe("MobileColumnFallback", () => {
  it("renders an explanatory notice", () => {
    render(<MobileColumnFallback gridHref="/nas/foo" />);
    expect(
      screen.getByText(/column view is desktop-only/i),
    ).toBeInTheDocument();
  });

  it("uses role='status' for the notice", () => {
    render(<MobileColumnFallback gridHref="/nas/foo" />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("renders a link to the grid href", () => {
    render(<MobileColumnFallback gridHref="/nas/foo?show=3d" />);
    const link = screen.getByRole("link", { name: /open in grid view/i });
    expect(link.getAttribute("href")).toBe("/nas/foo?show=3d");
  });

  it("uses md:hidden class so it only appears on small viewports", () => {
    const { container } = render(
      <MobileColumnFallback gridHref="/nas/foo" />,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain("md:hidden");
  });
});
