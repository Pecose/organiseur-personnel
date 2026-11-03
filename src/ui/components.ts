/** F20 · Composant commun : état cloud explicite, sans fausse confirmation. */
import type { SyncStatus } from "../domain/types";

/** M12 · Un statut local n'est jamais présenté comme sauvegardé sur serveur. */
export function renderCommonStatus(status: SyncStatus): void {
  const target = document.getElementById("sync-status");
  if (!target) return;
  const labels: Record<SyncStatus["state"], string> = {
    local: "Local ou hors connexion",
    pending: "Modifications en attente",
    synced: "Synchronisé",
    error: "Erreur de synchronisation",
  };
  target.className = "sync-state sync-" + status.state;
  target.textContent = status.message || labels[status.state];
  target.setAttribute("role", "status");
  target.setAttribute("aria-live", "polite");
}
