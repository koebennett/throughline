import { createContext, useContext } from "react";

export interface BrandCtx {
  brandId: string;
  brand: any;
  meta: any;
  setBrandId: (id: string | null) => void;
}
export const BrandContext = createContext<BrandCtx>({ brandId: "", brand: null, meta: null, setBrandId: () => {} });
export const useBrand = () => useContext(BrandContext);
