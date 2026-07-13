import { create } from 'zustand'

/**
 * Onboarding tour visibility (not persisted — completion is recorded
 * per-user in localStorage by OnboardingTour itself).
 * `openTour` is also called from the account menu ("App tour") so users
 * can replay the walkthrough at any time.
 */
interface OnboardingState {
  open: boolean
  openTour: () => void
  closeTour: () => void
}

export const useOnboardingStore = create<OnboardingState>((set) => ({
  open: false,
  openTour: () => set({ open: true }),
  closeTour: () => set({ open: false }),
}))
