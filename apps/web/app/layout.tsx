import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'verdict-desk',
  description: 'AI code-grading + doubt-resolution LMS portal',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
