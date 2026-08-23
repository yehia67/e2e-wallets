;; Minimal example contract this repo's tests call via `stx_callContract` -- proving Leather can
;; approve a real smart-contract interaction, not just a plain STX transfer. Deployed once to
;; testnet by scripts/deploy-counter-testnet.mjs; examples/react-connect calls it.
(define-data-var count uint u0)

(define-public (increment)
  (begin
    (var-set count (+ (var-get count) u1))
    (ok (var-get count))
  )
)

(define-read-only (get-count)
  (var-get count)
)
