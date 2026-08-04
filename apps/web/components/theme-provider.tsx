'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import type { ComponentProps } from 'react';

/**
 * Wraps next-themes so the app can toggle dark/light. Dark is the shipped
 * default (the judge app's committed look); the pre-paint script next-themes
 * injects sets the `.dark` class before first paint, so there's no flash.
 */
export function ThemeProvider({ children, ...props }: ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
