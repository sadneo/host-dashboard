import './globals.css';
import config from '../dashboard.config.json';

export const metadata = { title: `${config.hosts.map(host => host.name).join(' / ')} · host dashboard`, description: 'Live workstation status over Tailscale' };

export default function Layout({ children }) {
  return <html lang="en"><body>{children}</body></html>;
}
