/**
 * The trust-frame checks every zone surface the journey visits must pass:
 * the consent interstitial (real click-through, never cookie-seeded — the
 * journey exercises the SAME affirmative gate a real visitor hits), the
 * unremovable `ConceptDemoBanner`, and an axe (WCAG 2.1 A/AA) sweep.
 */
import AxeBuilder from "@axe-core/playwright";
import { disclaimerAssertions } from "@jeswr/solid-showcase-kit/testing";
import { expect, type Page } from "@playwright/test";

/**
 * Click through the per-app consent interstitial if it is showing (first
 * visit to THIS zone in the browser context only shows it once — later
 * navigations within the same app carry the cookie).
 */
export async function acknowledgeInterstitial(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog", { name: disclaimerAssertions.interstitialHeading });
  if (await dialog.isVisible().catch(() => false)) {
    await dialog
      .getByRole("button", { name: disclaimerAssertions.interstitialContinueLabel })
      .click();
    await expect(dialog).toBeHidden();
  }
}

/** The unremovable `ConceptDemoBanner` renders on this page. */
export async function expectBannerVisible(page: Page): Promise<void> {
  const banner = page.locator(disclaimerAssertions.bannerSelector).first();
  await expect(banner).toBeVisible();
  await expect(banner).toHaveAccessibleName(disclaimerAssertions.bannerAriaLabel);
}

/** WCAG 2.1 A/AA — zero serious/critical (in fact zero) violations on the CURRENT page state. */
export async function expectAxeClean(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}
