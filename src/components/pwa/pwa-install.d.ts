import type { DetailedHTMLProps, HTMLAttributes } from "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "pwa-install": DetailedHTMLProps<
        HTMLAttributes<HTMLElement> & {
          "manual-chrome"?: boolean | string;
          "manual-apple"?: boolean | string;
          "disable-screenshots"?: boolean | string;
          "disable-fast-app-install"?: boolean | string;
          "disable-fast-chrome-popup"?: boolean | string;
          name?: string;
          description?: string;
          icon?: string;
          "manifest-url"?: string;
        },
        HTMLElement
      >;
    }
  }
}

export {};
