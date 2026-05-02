"use client";

import { createContext, useContext, type ReactNode } from "react";

export type AppSettings = {
  appName: string;
  accent: string;
  logoUrl: string;
};

const Ctx = createContext<AppSettings>({
  appName: "Minifold",
  accent: "#3b82f6",
  logoUrl: "",
});

export function SettingsProvider({
  value,
  children,
}: {
  value: AppSettings;
  children: ReactNode;
}) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSettings(): AppSettings {
  return useContext(Ctx);
}
