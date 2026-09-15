import React, { useState, useEffect } from 'react';
import { MessageSquare, ArrowUp, Send, CheckCircle2, RefreshCw, AlertCircle } from 'lucide-react';
import { streamApiClient, parseErrorMessage } from '../services/apiClient';

interface Question {
  id: string;
  user_email: string;
  question_text: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'ANSWERED';
  upvotes: number;
  created_at: string;
}

const UPVOTED_KEY      = 'user_upvoted_questions_set';
const TIMESTAMPS_KEY   = 'user_question_submission_timestamps';

export const QnAPanel: React.FC = () => {
  const [questions,       setQuestions]       = useState<Question[]>([]);
  const [newText,         setNewText]         = useState<string>('');
  const [isLoading,       setIsLoading]       = useState<boolean>(false);
  const [isSubmitting,    setIsSubmitting]     = useState<boolean>(false);
  const [errorMsg,        setErrorMsg]        = useState<string | null>(null);
  const [successMsg,      setSuccessMsg]      = useState<string | null>(null);

  const [upvotedIds, setUpvotedIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(UPVOTED_KEY);
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch { return new Set(); }
  });

  /* ── Fetch questions ── */
  const fetchQuestions = async () => {
    try {
      setIsLoading(true);
      const res = await streamApiClient.get('/questions/');
      if (res.data?.success) setQuestions(res.data.data.questions || []);
    } catch (err) {
      console.error('Failed to load questions:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchQuestions();
    const iv = setInterval(fetchQuestions, 10000);
    return () => clearInterval(iv);
  }, []);

  /* ── Rate-limit helpers (3 per minute) ── */
  const checkRateLimit = (): { allowed: boolean; waitSeconds: number } => {
    try {
      const now = Date.now();
      const raw = localStorage.getItem(TIMESTAMPS_KEY);
      const ts: number[] = raw ? JSON.parse(raw) : [];
      const valid = ts.filter((t) => now - t < 60000);
      localStorage.setItem(TIMESTAMPS_KEY, JSON.stringify(valid));
      if (valid.length >= 3) {
        return { allowed: false, waitSeconds: Math.ceil((60000 - (now - valid[0])) / 1000) };
      }
      return { allowed: true, waitSeconds: 0 };
    } catch { return { allowed: true, waitSeconds: 0 }; }
  };

  const recordTimestamp = () => {
    try {
      const now = Date.now();
      const raw = localStorage.getItem(TIMESTAMPS_KEY);
      const ts: number[] = raw ? JSON.parse(raw) : [];
      const valid = ts.filter((t) => now - t < 60000);
      valid.push(now);
      localStorage.setItem(TIMESTAMPS_KEY, JSON.stringify(valid));
    } catch { /* ignore */ }
  };

  /* ── Submit question ── */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    const trimmed = newText.trim();
    if (!trimmed) { setErrorMsg('Please enter your question.'); return; }
    if (trimmed.length < 5) { setErrorMsg('Question must be at least 5 characters.'); return; }

    const { allowed, waitSeconds } = checkRateLimit();
    if (!allowed) {
      setErrorMsg(`Rate limit: max 3 questions per minute. Wait ${waitSeconds}s.`);
      return;
    }

    try {
      setIsSubmitting(true);
      const res = await streamApiClient.post('/questions/', { question_text: trimmed });
      if (res.data?.success) {
        recordTimestamp();
        setSuccessMsg('Question submitted!');
        setNewText('');
        fetchQuestions();
        setTimeout(() => setSuccessMsg(null), 4000);
      }
    } catch (err) {
      setErrorMsg(parseErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  /* ── Upvote ── */
  const handleUpvote = async (id: string) => {
    setErrorMsg(null);
    if (upvotedIds.has(id)) {
      setErrorMsg('You have already upvoted this question.');
      setTimeout(() => setErrorMsg(null), 3000);
      return;
    }

    const next = new Set(upvotedIds).add(id);
    setUpvotedIds(next);
    localStorage.setItem(UPVOTED_KEY, JSON.stringify(Array.from(next)));
    setQuestions((prev) => prev.map((q) => q.id === id ? { ...q, upvotes: q.upvotes + 1 } : q));

    try {
      await streamApiClient.post(`/questions/${id}/upvote/`);
    } catch (err) {
      // Revert
      const rev = new Set(upvotedIds); rev.delete(id);
      setUpvotedIds(rev);
      localStorage.setItem(UPVOTED_KEY, JSON.stringify(Array.from(rev)));
      fetchQuestions();
      setErrorMsg(parseErrorMessage(err));
    }
  };

  return (
    <div className="qna-panel flex flex-col bg-slate-900 h-full max-h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 shrink-0">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400">
            <MessageSquare className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-white font-bold text-sm">Live Q&amp;A</h3>
            <p className="text-slate-400 text-[10px]">Max 3 per minute · 1 upvote per question</p>
          </div>
        </div>
        <button
          onClick={fetchQuestions}
          className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-all border border-white/5"
          title="Refresh"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-amber-400' : ''}`} />
        </button>
      </div>

      {/* Submission form */}
      <form onSubmit={handleSubmit} className="px-4 py-3 border-b border-white/10 space-y-2 shrink-0">
        <div className="relative">
          <textarea
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            placeholder="Type your question for the speakers…"
            rows={2}
            maxLength={1000}
            className="w-full bg-slate-950/80 border border-white/10 rounded-xl p-2.5 pr-12 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-all resize-none"
          />
          <span className="absolute bottom-2 right-2.5 text-[10px] text-slate-600 font-mono pointer-events-none">
            {newText.length}/1000
          </span>
        </div>

        {errorMsg && (
          <div className="flex items-start gap-1.5 text-xs text-red-400 bg-red-950/40 px-2.5 py-2 rounded-lg border border-red-500/20 animate-shake">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}
        {successMsg && (
          <div className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-950/40 px-2.5 py-2 rounded-lg border border-emerald-500/20">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={isSubmitting || !newText.trim()}
          className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-sm shadow-lg shadow-amber-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
        >
          <Send className="w-3.5 h-3.5" />
          <span>{isSubmitting ? 'Submitting…' : 'Submit Question'}</span>
        </button>
      </form>

      {/* Question list — scrollable */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {questions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-slate-500 text-center">
            <MessageSquare className="w-7 h-7 opacity-30 mb-2" />
            <p className="text-sm font-medium">No questions yet.</p>
            <p className="text-xs">Be the first to ask!</p>
          </div>
        ) : (
          questions.map((q) => {
            const voted = upvotedIds.has(q.id);
            return (
              <div
                key={q.id}
                className={`p-3 rounded-xl border transition-all ${
                  q.status === 'ANSWERED'
                    ? 'bg-amber-950/20 border-amber-500/25'
                    : 'bg-slate-950/60 border-white/5 hover:border-white/10'
                }`}
              >
                <div className="flex items-start gap-2">
                  {/* Question text */}
                  <p className="flex-1 text-sm text-slate-200 leading-relaxed min-w-0">{q.question_text}</p>

                  {/* Upvote button */}
                  <button
                    onClick={() => handleUpvote(q.id)}
                    disabled={voted}
                    className={`flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-lg border text-xs font-bold shrink-0 transition-all active:scale-90 ${
                      voted
                        ? 'bg-amber-500/15 text-amber-400 border-amber-500/30 cursor-default'
                        : 'bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-amber-400 border-white/10'
                    }`}
                    title={voted ? 'Already upvoted' : 'Upvote'}
                  >
                    <ArrowUp className={`w-3.5 h-3.5 ${voted ? 'text-amber-400' : ''}`} />
                    <span className="leading-none">{q.upvotes}</span>
                  </button>
                </div>

                {/* Footer */}
                <div className="mt-2 flex items-center justify-between text-[10px] text-slate-500">
                  <span className="truncate max-w-[160px]">{q.user_email}</span>
                  {q.status === 'ANSWERED' && (
                    <span className="flex items-center gap-1 text-amber-400 font-semibold">
                      <CheckCircle2 className="w-3 h-3" /> Answered
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
