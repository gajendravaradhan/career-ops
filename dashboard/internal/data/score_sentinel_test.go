package data

import (
	"os"
	"path/filepath"
	"testing"
)

func TestScoreSentinelsAndRealZeroRemainDistinct(t *testing.T) {
	dir := t.TempDir()
	content := `| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 1 | 2026-08-11 | Scored | QA | 4.2/5 | Evaluated | — | — | score |
| 2 | 2026-08-11 | EmDash | QA | — | Evaluated | — | — | absent |
| 3 | 2026-08-11 | NA | QA | N/A | Evaluated | — | — | absent |
| 4 | 2026-08-11 | Hyphen | QA | - | Evaluated | — | — | absent |
| 5 | 2026-08-11 | RealZero | QA | 0.0/5 | Evaluated | — | — | scored zero |
`
	if err := os.WriteFile(filepath.Join(dir, "applications.md"), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	apps := ParseApplications(dir)
	if len(apps) != 5 {
		t.Fatalf("got %d rows, want 5", len(apps))
	}
	for _, app := range apps {
		want := app.Company == "Scored" || app.Company == "RealZero"
		if app.HasScore != want {
			t.Errorf("%s HasScore=%v, want %v", app.Company, app.HasScore, want)
		}
	}
	metrics := ComputeMetrics(apps)
	if metrics.AvgScore != 2.1 {
		t.Errorf("AvgScore=%v, want 2.1 (real zero participates; sentinels do not)", metrics.AvgScore)
	}
}
