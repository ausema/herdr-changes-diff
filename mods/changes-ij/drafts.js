// The commit message being written for each repo, so looking at another space or repo doesn't lose it.
// Kept in memory while the panel lives; a repo is its machine plus its root.
export class CommitDrafts {
  #messageByRepo = new Map();

  #key(on, root) {
    return JSON.stringify([on ?? null, root]);
  }

  get size() {
    return this.#messageByRepo.size;
  }

  get(on, root) {
    return this.#messageByRepo.get(this.#key(on, root)) ?? "";
  }

  keep(on, root, message) {
    if (message) {
      this.#messageByRepo.set(this.#key(on, root), message);
    } else {
      this.drop(on, root);
    }
  }

  drop(on, root) {
    this.#messageByRepo.delete(this.#key(on, root));
  }
}
