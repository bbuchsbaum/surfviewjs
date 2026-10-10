import '@fontsource-variable/archivo/wdth.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
import './style.css';
import { parcelPuzzle } from './chapters/parcelPuzzle';
import { runStandalone } from './kit/parcel-standalone';

runStandalone(parcelPuzzle);
