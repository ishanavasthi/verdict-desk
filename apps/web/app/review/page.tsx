import { redirect } from 'next/navigation';
import { getAuthToken, getMe } from '../../lib/auth';
import { getReviewQueue, type ReviewQueueItem } from '../../lib/api';
import NavLinks from '../../components/NavLinks';
import LogoutButton from '../../components/LogoutButton';
import ReviewQueueList from '../../components/ReviewQueueList';

export const dynamic = 'force-dynamic';

export default async function ReviewPage() {
  const token = await getAuthToken();
  if (!token) {
    redirect('/login');
  }
  const user = await getMe();
  if (!user) {
    redirect('/login');
  }
  if (user.role !== 'TEACHER') {
    redirect('/');
  }

  let queue: ReviewQueueItem[] = [];
  let unreachable = false;
  try {
    queue = await getReviewQueue(token);
  } catch {
    unreachable = true;
  }

  return (
    <main className="container container-wide">
      <header className="page-header">
        <div>
          <h1>Review queue</h1>
          <p className="user-meta">
            {user.email} <span className="role-pill">{user.role.toLowerCase()}</span>
          </p>
        </div>
        <div className="header-actions">
          <NavLinks role={user.role} />
          <LogoutButton />
        </div>
      </header>

      <section className="card">
        {unreachable ? (
          <p className="empty-state">Could not load the review queue — API unreachable.</p>
        ) : (
          <ReviewQueueList initialQueue={queue} />
        )}
      </section>
    </main>
  );
}
