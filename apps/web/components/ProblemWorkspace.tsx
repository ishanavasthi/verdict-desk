'use client';

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { useMediaQuery } from '@/lib/use-media-query';
import type { ProblemDetail } from '@/lib/api';
import ProblemPanel from './ProblemPanel';
import SubmitEditor from './SubmitEditor';
import AnswerEditor from './AnswerEditor';

/**
 * The LeetCode-style split workspace. On desktop it's a draggable two-pane
 * layout — the case on the left, the code box + verdict on the right — filling
 * the viewport below the header. On narrow screens the two stack into normal
 * document flow so nothing gets crushed.
 */
export default function ProblemWorkspace({ problem }: { problem: ProblemDetail }) {
  const isDesktop = useMediaQuery('(min-width: 768px)');

  const casePane = (
    <div className="h-full rounded-xl border border-border bg-card">
      <ProblemPanel problem={problem} />
    </div>
  );
  const editorPane = (
    <div className="h-full rounded-xl border border-border bg-card">
      {problem.kind === 'CODE' ? (
        <SubmitEditor problemId={problem.id} problemTitle={problem.title} />
      ) : (
        <AnswerEditor problemId={problem.id} kind={problem.kind} options={problem.options} />
      )}
    </div>
  );

  if (isDesktop) {
    return (
      <div className="h-[calc(100vh-3.5rem)] px-3 py-3">
        <ResizablePanelGroup orientation="horizontal" className="gap-3">
          <ResizablePanel defaultSize={44} minSize={28}>
            {casePane}
          </ResizablePanel>
          <ResizableHandle withHandle className="bg-transparent" />
          <ResizablePanel defaultSize={56} minSize={34}>
            {editorPane}
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-3 px-3 py-3">
      <div className="min-h-[40vh]">{casePane}</div>
      <div className="min-h-[70vh]">{editorPane}</div>
    </div>
  );
}
