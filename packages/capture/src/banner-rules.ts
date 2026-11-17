import { FlawDotError } from "@flawdot/core-model";

// Consent banners are hidden, never clicked: a click can record a consent, start the scripts of the site or
// navigate. What is hidden is a list of containers of known tools, and a rule for any other banner: a fixed or
// sticky box whose text asks for cookies and that has an accept or reject button. A banner that is hidden is not
// audited by axe: that is the price of a page without a banner in front of it.
//
// There are no guesses on a class such as ".cookie" or "[class*=consent]": real content has such names, and what
// is hidden by mistake is not seen by anyone, axe included.

export interface BannerRules {
  /** CSS selectors of containers of known tools. They go into a style rule, so they are checked. */
  selectors: readonly string[];
  /** Text, lower case, that a banner says. An element is compared with `includes`, never as a pattern. */
  consentPhrases: readonly string[];
  /** Words, lower case, that the button of a banner says. */
  buttonWords: readonly string[];
}

export const BANNER_RULES: BannerRules = {
  selectors: [
    "#onetrust-consent-sdk",
    "#onetrust-banner-sdk",
    "#onetrust-pc-sdk",
    ".onetrust-pc-dark-filter",
    "#CybotCookiebotDialog",
    "#CybotCookiebotDialogBodyUnderlay",
    "#iubenda-cs-banner",
    "#didomi-host",
    ".qc-cmp2-container",
    "#cmplz-cookiebanner-container",
    ".cmplz-cookiebanner",
    ".osano-cm-window",
    ".cky-consent-container",
    "#usercentrics-root",
    "#cookie-notice",
  ],
  consentPhrases: [
    "we use cookies",
    "this website uses cookies",
    "this site uses cookies",
    "cookie settings",
    "cookie preferences",
    "accept all cookies",
    "utilizziamo i cookie",
    "questo sito utilizza i cookie",
    "questo sito usa i cookie",
    "usiamo i cookie",
    "impostazioni dei cookie",
    "accetta tutti",
    "gestisci i cookie",
  ],
  buttonWords: [
    "accept",
    "agree",
    "allow",
    "reject",
    "decline",
    "got it",
    "accetta",
    "accetto",
    "rifiuta",
    "personalizza",
    "gestisci",
  ],
};

/** Characters that would let a selector leave the style rule it is written in. */
const UNSAFE_IN_RULE = /[{};<>]/;

/** The style that hides the containers of the list. The list is checked first: it ends up inside the page. */
export function hidingStyleFor(rules: BannerRules): string {
  const { selectors } = rules;
  if (selectors.length === 0) {
    throw new FlawDotError("INTERNAL", "The list of banners has no selector");
  }
  if (new Set(selectors).size !== selectors.length) {
    throw new FlawDotError("INTERNAL", "The list of banners repeats a selector");
  }
  for (const selector of selectors) {
    if (selector.trim() === "" || UNSAFE_IN_RULE.test(selector)) {
      throw new FlawDotError(
        "INTERNAL",
        "The list of banners has a selector that cannot be used in a style rule",
      );
    }
  }
  return `${selectors.join(",")}{display:none!important}`;
}
