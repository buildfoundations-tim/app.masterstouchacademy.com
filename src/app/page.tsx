import { redirect } from 'next/navigation';

/** The app has no public landing page — that lives on the marketing site. */
export default function Home() {
  redirect('/classroom');
}
