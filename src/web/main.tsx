import { createRoot } from 'react-dom/client'
import { App } from './App'
import { TurnSpike } from './spike/TurnSpike'
import './styles.css'

// Disposable turn-based spike lives behind ?spike — never touches the shipped app.
const spike = new URLSearchParams(location.search).has('spike')
createRoot(document.getElementById('root')!).render(spike ? <TurnSpike /> : <App />)
