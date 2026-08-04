'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LogoutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleLogout() {
    setLoading(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Best-effort: even if the request fails, still send the user to /login.
    } finally {
      router.push('/login');
      router.refresh();
    }
  }

  return (
    <button type="button" className="btn btn-secondary" onClick={handleLogout} disabled={loading}>
      {loading ? 'Logging out…' : 'Logout'}
    </button>
  );
}
