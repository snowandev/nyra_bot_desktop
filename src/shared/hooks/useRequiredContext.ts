import { type Context, useContext } from "react";

// A context the app always provides: reading it outside its provider is a mistake of the code, said at once
export function useRequiredContext<T>(context: Context<T | null>, name: string): T {
  const value = useContext(context);
  if (value === null) throw new Error(`${name} solo se puede usar dentro de su proveedor de contexto.`);
  return value;
}
