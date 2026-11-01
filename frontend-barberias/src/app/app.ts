import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ToastContainerComponent } from './shared/ui/toast/toast-container.component';
import { ConfirmDialogComponent } from './shared/ui/confirm-dialog/confirm-dialog.component';

@Component({
  imports: [RouterOutlet, ToastContainerComponent, ConfirmDialogComponent],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  protected readonly title = signal('frontend-barberias');
}
