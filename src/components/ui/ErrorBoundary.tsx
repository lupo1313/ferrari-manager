import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

/** Évite l'écran blanc en plein service : les données locales restent intactes, il suffit de recharger. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Ferrari Manager : erreur d’affichage', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash">
        <h1>Une erreur d’affichage est survenue</h1>
        <p>Les commandes et clients enregistrés sont conservés dans ce navigateur. Rechargez l’application pour reprendre.</p>
        <pre>{this.state.error.message}</pre>
        <button type="button" className="btn btn--primary btn--lg" onClick={() => window.location.reload()}>
          Recharger l’application
        </button>
      </div>
    );
  }
}
