import { PRODUCT_RELEASES_URL, PRODUCT_SUPPORT_URL, localizedProductPage } from "@openpixo/contracts";

export interface HelpMenuLink {
  label: string;
  url: string;
}

/** The pages the application menu's Help section opens in the browser. */
export function helpMenuLinks(locale: string): HelpMenuLink[] {
  return [
    { label: "Get Support", url: localizedProductPage(PRODUCT_SUPPORT_URL, locale) },
    { label: "Changelog", url: localizedProductPage(PRODUCT_RELEASES_URL, locale) },
  ];
}
