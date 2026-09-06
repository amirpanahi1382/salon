import { Injectable } from '@nestjs/common';

@Injectable()
export class ShutdownState {
  private draining = false;

  markDraining(): void {
    this.draining = true;
  }

  isDraining(): boolean {
    return this.draining;
  }
}
