'use client';

import { useMemo } from 'react';
import { useTheme } from 'next-themes';
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView } from '@codemirror/view';

/**
 * The submission code box: a real CodeMirror editor with JS syntax
 * highlighting and line numbers. Bundled (no network), theme-aware (one-dark
 * in dark mode, the default light theme otherwise). The surrounding chrome
 * (border, background) is styled by `.cm-editor` rules in globals.css so it
 * sits flush inside the editor pane.
 */
export default function CodeEditor({
  value,
  onChange,
  readOnly = false,
  ariaLabel = 'Solution code',
}: {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  ariaLabel?: string;
}) {
  const { resolvedTheme } = useTheme();
  const isLight = resolvedTheme === 'light';

  const extensions = useMemo(
    () => [javascript({ jsx: false, typescript: false }), EditorView.lineWrapping],
    [],
  );

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      readOnly={readOnly}
      theme={isLight ? 'light' : oneDark}
      extensions={extensions}
      basicSetup={{
        lineNumbers: true,
        foldGutter: false,
        highlightActiveLine: !readOnly,
        highlightActiveLineGutter: !readOnly,
        autocompletion: false,
      }}
      height="100%"
      className="h-full"
      aria-label={ariaLabel}
    />
  );
}
