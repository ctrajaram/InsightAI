'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function AuthPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  useEffect(() => {
    const returnUrl = searchParams.get('returnUrl') || '/dashboard';
    router.push(`/login?returnUrl=${encodeURIComponent(returnUrl)}`);
  }, [router, searchParams]);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <h2 className="text-lg font-medium mb-2">Redirecting to login...</h2>
        <p className="text-sm text-muted-foreground">Please wait while we redirect you to the login page.</p>
      </div>
    </div>
  );
}
