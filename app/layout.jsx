import './globals.css';

export const metadata = { title: 'babel / waka · host dashboard', description: 'Live workstation status over Tailscale' };

export default function Layout({ children }) {
  return <html lang="en"><body>{children}</body></html>;
}
