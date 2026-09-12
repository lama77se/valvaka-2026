// React-wiring runt computeAreaView (src/lib/areaView.ts): hämtar de globala,
// valtyp-oberoende referensdata-refarna ur ResultsProvider och memoiserar om på
// samma beroenden som ResultPanel.tsx:s view-useMemo gjorde innan extraktionen
// (valtyp, area, revision — se computeAreaView-anropet nedan). Both ResultPanel
// (globalt state) och Dashboard-vyns rutor (lokalt state per ruta) anropar denna
// med SINA respektive valtyp/area — datan (storesRef m.fl.) är gemensam.
//
// valkretsListRef (INTE context-fältet `valkretsar`, som bara täcker den GLOBALT
// AKTIVA valtypen): Dashboard-rutorna anropar denna hook med SIN EGEN valtyp, som
// kan skilja sig från den aktiva — samma mönster som DepartureBoard.tsx redan
// löser problemet med (se dess `valkretsName`-useMemo).
import { useMemo } from 'react'
import { useResults, type Area } from '@/components/ResultsProvider'
import { computeAreaView, type AreaViewResult } from '@/lib/areaView'
import type { Valtyp } from '@/lib/results'

export function useAreaView(valtyp: Valtyp, area: Area): AreaViewResult {
  const {
    storesRef, turnoutStoresRef, allCodesRef, metaRef, partyRef, groupsRef, uppsamlingRef,
    areaIndexRef, comparisonRef, district2022Ref, kommuner, regioner, valkretsListRef,
    distriktNamnRef, revision, snapshotVersion,
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
        valkretsar: valkretsListRef.current[valtyp] ?? [],
        distriktNamn: distriktNamnRef.current,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [valtyp, area, revision, snapshotVersion, kommuner, regioner],
  )
}
