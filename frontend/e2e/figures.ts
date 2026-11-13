import { readFileSync } from "node:fs";
import { expect, type Locator, type Page } from "@playwright/test";

// Synthetic two-node diagram, drawn locally with Pillow at 2x density.
export const figureFile = {
  name: "question-figure.png",
  mimeType: "image/png",
  buffer: readFileSync(new URL("./fixtures/question-figure.png", import.meta.url)),
};

export async function expectFigureLoaded(scope: Page | Locator, alt: string) {
  const image = scope.getByRole("img", { name: alt, exact: true });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBeGreaterThan(0);
}

export async function uploadGuestFigure(page: Page, basePath = ""): Promise<string> {
  return page.evaluate(async ({ encoded, basePath }) => {
    const csrf = document.cookie.split("; ").find(v => /^(?:__Host-)?training_csrf=/.test(v))?.split("=")[1] || "";
    const form = new FormData();
    form.append("file", new Blob([Uint8Array.from(atob(encoded), c => c.charCodeAt(0))], { type: "image/png" }), "question-figure.png");
    const response = await fetch(`${basePath}/api/question-figures/`, {
      method: "POST", headers: { "X-CSRFToken": decodeURIComponent(csrf) }, body: form,
    });
    if (!response.ok) throw new Error("Synthetic figure upload failed");
    return (await response.json()).key;
  }, { encoded: figureFile.buffer.toString("base64"), basePath });
}
