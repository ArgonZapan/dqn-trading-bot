# Bugs Checklista — DQN Trading Bot

> Ostatnia aktualizacja: 2026-03-23

## Do naprawy (priorytet)

- [ ] **BUG-001** — Stan przycisków nie synchronizuje się z serwerem po odświeżeniu (ważny)
- [ ] **BUG-005** — Brak globalnej obsługi błędów fetch (ważny)
- [ ] **BUG-010** — Brak autentyfikacji na endpointach API (ważny/security)
- [ ] **BUG-003** — Pusty catch w updatePrices() — brak logowania ( średni)
- [ ] **BUG-004** — Brak walidacji relacji SL/TP ( średni)
- [ ] **BUG-006** — trainingStep() bez mutex — nakładanie kroków ( średni/wydajność)
- [ ] **BUG-008** — Brak rate limiting ( średni/security)
- [ ] **BUG-012** — Model nie zapisywany przy SIGTERM ( średni)
- [ ] **BUG-002** — Brak ładowania stanu Paper Trading przy starcie ( średni)
- [ ] **BUG-009** — prevEpData nie aktualizowane gdy <3 candles ( niski)
- [ ] **BUG-007** — Monolityczny plik HTML ( kosmetyczny/tech debt)
- [ ] **BUG-011** — Scroll reset przy odświeżaniu ( kosmetyczny)

## Zgłoszone (wcześniej)

- [x] BUG-001–005 z 2026-03-22 — commit `f134f17`
