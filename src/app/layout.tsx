import type { Metadata } from 'next';
import { Instrument_Serif, Work_Sans } from 'next/font/google';
import './globals.css';

// Same two families as the marketing site. Loaded through next/font so they are
// self-hosted at build time — no request to Google from the visitor's browser.
const display = Instrument_Serif({
  variable: '--font-display',
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  display: 'swap',
});

const body = Work_Sans({
  variable: '--font-body',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Masters Touch Academy',
    template: '%s · Masters Touch Academy',
  },
  description: 'Courses, progress, certificates, and CEC hours for Masters Touch Academy members.',
  // The member app sits behind a login; keep it out of search results entirely.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}
