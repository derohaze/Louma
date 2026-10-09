package logging

import (
	"io"
	"log/slog"
	"os"
	"runtime"
	"strings"
)

const reset = "\x1b[0m"

type colorWriter struct {
	out     io.Writer
	enabled bool
}

func NewHandler(out io.Writer) slog.Handler {
	return slog.NewTextHandler(colorWriter{out: out, enabled: colorsEnabled()}, &slog.HandlerOptions{
		ReplaceAttr: func(_ []string, attr slog.Attr) slog.Attr {
			if attr.Key == slog.TimeKey {
				return slog.String(slog.TimeKey, attr.Value.Time().Format("15:04:05.000"))
			}
			return attr
		},
	})
}

func (w colorWriter) Write(line []byte) (int, error) {
	if !w.enabled {
		return w.out.Write(line)
	}

	text := string(line)
	levelStart := strings.Index(text, "level=")
	if levelStart < 0 {
		return w.out.Write(line)
	}
	levelStart += len("level=")
	levelEnd := strings.IndexByte(text[levelStart:], ' ')
	if levelEnd < 0 {
		return w.out.Write(line)
	}
	levelEnd += levelStart
	level := text[levelStart:levelEnd]
	color := "\x1b[36m"
	switch {
	case strings.HasPrefix(level, "ERROR"):
		color = "\x1b[31;1m"
	case strings.HasPrefix(level, "WARN"):
		color = "\x1b[33m"
	case strings.HasPrefix(level, "INFO"):
		color = "\x1b[32m"
	case strings.HasPrefix(level, "DEBUG"):
		color = "\x1b[90m"
	}
	text = text[:levelStart] + color + level + reset + text[levelEnd:]
	if _, err := io.WriteString(w.out, text); err != nil {
		return 0, err
	}
	return len(line), nil
}

func colorsEnabled() bool {
	if os.Getenv("FORCE_COLOR") != "" {
		return true
	}
	if _, disabled := os.LookupEnv("NO_COLOR"); disabled {
		return false
	}
	if runtime.GOOS == "windows" {
		return true
	}
	term := os.Getenv("TERM")
	return term != "" && term != "dumb"
}
