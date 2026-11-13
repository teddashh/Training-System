import { Component, type ReactNode } from 'react';
import { ErrorBox } from './ui';
import { t } from './i18n';

export default class LazyPageBoundary extends Component<{children: ReactNode}, {failed: boolean}> {
  state = {failed: false};
  static getDerivedStateFromError() { return {failed: true}; }
  render() {
    return this.state.failed ? <section className="panel"><ErrorBox message={t('This page could not be loaded. Please try again.')}/>
      <button type="button" className="btn" onClick={() => window.location.reload()}>{t('Reload page')}</button></section> : this.props.children;
  }
}
