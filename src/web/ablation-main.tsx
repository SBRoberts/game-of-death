import { createRoot } from 'react-dom/client'
import { TitleScreenAbl } from './TitleScreenAbl'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <TitleScreenAbl onStart={() => {}} onHowTo={() => {}} />,
)
