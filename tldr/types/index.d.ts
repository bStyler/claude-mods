/** The last long reply, as the mod read it. */
export type Brief = { tldr: string; marked: number }

declare module 'claude-code' {
  interface PluginState {
    tldr: {
      /** Highlight long replies. Kept across sessions in $.store. */
      isOn: boolean
      /** The model is reading a reply. */
      isBusy: boolean
      /** The TL;DR of the last long reply, or null when the last reply was short. */
      brief: Brief | null
      /** The id of the last reply read, so one reply is never sent to the model twice. */
      lastRead: string | null
      /** A reply arrived while one was being read: read again when done. */
      again: boolean
      /** One flag per paragraph, by its id (keyOf): true when it is highlighted. */
      marked: StateFamily<boolean>
    }
  }
}
