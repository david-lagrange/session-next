import GuidedSession from "@/app/lib/ui/guided-session/GuidedSession";

export default function GuidedSessionPage() {
  console.log('[GuidedSessionPage] Rendering page component');
  
  // This will run on the server during SSR and on the client after hydration
  if (typeof window !== 'undefined') {
    console.log('[GuidedSessionPage] Running in browser environment');
  } else {
    console.log('[GuidedSessionPage] Running in server environment (SSR)');
  }
  
  return (
    <div className="guided-session-page p-4 h-[calc(100vh-4rem)]">
      <h1 className="text-2xl font-bold mb-6 text-center">Guided Session</h1>
      
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 h-[calc(100%-4rem)]">
        <GuidedSession />
      </div>
    </div>
  );
}
