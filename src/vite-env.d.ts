/// <reference types="vite/client" />

// A font for pdfmake, shipped without its own types
declare module "pdfmake/build/standard-fonts/Courier" {
  import type { TFontContainer } from "pdfmake/interfaces";
  const container: TFontContainer;
  export default container;
}
