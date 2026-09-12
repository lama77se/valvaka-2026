// React-wiring runt computeAreaView (src/lib/areaView.ts): hämtar de globala,
// valtyp-oberoende referensdata-refarna ur ResultsProvider och memoiserar om på
// samma beroenden som ResultPanel.tsx:s view-useMemo gjorde innan extraktionen
// (valtyp, area, revision — se computeAreaView-anropet nedan). Both ResultPanel
// (globalt state) och Dashboard-vyns rutor (lokalt state per ruta) anropar denna
// med SINA respektive valtyp/area — datan (storesRef m.fl.) är gemensam.
import { useMemo } from 'react'
import { useResults, type Area } from '@/components/ResultsProvider'
import { computeAreaView, type AreaViewResult } from '@/lib/areaView'
import type { Valtyp } from '@/lib/results'

export function useAreaView(valtyp: Valtyp, area: Area): AreaViewResult {
  const {
    storesRef, turnoutStoresRef, allCodesRef, metaRef, partyRef, groupsRef, uppsamlingRef,
    areaIndexRef, comparisonRef, district2022Ref, kommuner, regioner, valkretsar,
    distriktNamnRef, revision,
  } = useResults()

  return useMemo(
    () =>
      computeAreaView({
        valtyp,
        area,
        store: storesRef.current[valtyp],
        turnoutStore: turnoutStoresRef.current[valtyp],
        allCodes: allCodesRef.current,
        meta: metaRef.current,
        party: partyRef.current,
        groups: groupsRef.current,
        uppsamling: uppsamlingRef.current[valtyp],
        areaIndex: areaIndexRef.current[valtyp],
        comparison: comparisonRef.current,
        district2022: district2022Ref.current,
        kommuner,
        regioner,
        valkretsar,
        distriktNamn: distriktNamnRef.current,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [valtyp, area, revision, kommuner, regioner, valkretsar],
  )
}
