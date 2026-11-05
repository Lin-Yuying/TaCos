export class TacosError extends Error {
  status: number;
  hint?: string;

  constructor(message: string, status = 400, hint?: string) {
    super(message);
    this.status = status;
    this.hint = hint;
  }
}
