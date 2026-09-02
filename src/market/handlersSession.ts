import type { MessageInitShape } from '@bufbuild/protobuf'
import { Compounding, DayCounter_Family, Frequency } from '@/gen/quantlib/v1/conventions_pb'
import type { PriceRequestSchema } from '@/gen/quantlib/v2/envelope_pb'
import { Engine_Method } from '@/gen/quantlib/v2/engine_pb'
import { Exercise_Type, Payoff_OptionType, Underlying_Process } from '@/gen/quantlib/v2/instrument_pb'
import { type MarketObjectSchema, Quote_Unit } from '@/gen/quantlib/v2/market_pb'
import { ResultKind } from '@/gen/quantlib/v2/results_pb'

export type MarketObjectInit = MessageInitShape<typeof MarketObjectSchema>
export type PriceRequestInit = MessageInitShape<typeof PriceRequestSchema>

/** The worked session from ql-backend/HANDLERS.md, as data.
 *
 *  M0 uses it as the acceptance case: it is the one request whose answer is
 *  written down (12.459717), so it checks the whole stack — codegen, framing,
 *  request correlation, the terminal-frame contract — against a number rather
 *  than against "no exception was thrown".
 *
 *  Objects are listed in dependency order, which is the client's job: the
 *  session resolves ids against its maps as it fills, and a forward reference
 *  is an error. M1 replaces this literal ordering with a topological sort.
 */

const act360 = { family: DayCounter_Family.ACTUAL_360 } as const

function quote(
  id: string,
  value: number,
  unit: Quote_Unit,
  displayName: string,
): MarketObjectInit {
  return { id, displayName, kind: { case: 'quote', value: { value, unit } } }
}

/** FlatForward on a live quote. `rate` is a quote_id rather than a literal, so
 *  writing the quote reprices off the same curve object (market.proto rule 1). */
function flatCurve(id: string, rateQuoteId: string, displayName: string): MarketObjectInit {
  return {
    id,
    displayName,
    kind: {
      case: 'yieldCurve',
      value: {
        dayCounter: act360,
        shape: {
          case: 'flat',
          value: {
            rate: { source: { case: 'quoteId', value: rateQuoteId } },
            compounding: Compounding.CONTINUOUS,
            frequency: Frequency.ANNUAL,
          },
        },
      },
    },
  }
}

export const HANDLERS_EVALUATION_DATE = '2026-09-01'
export const HANDLERS_EXPIRY = '2027-09-01'

export const handlersMarket: MarketObjectInit[] = [
  quote('S', 100.0, Quote_Unit.ABSOLUTE, 'Spot'),
  quote('R', 0.05, Quote_Unit.RATE, 'Risk-free rate'),
  quote('Q', 0.02, Quote_Unit.RATE, 'Dividend yield'),
  quote('V', 0.2, Quote_Unit.VOLATILITY, 'Volatility'),
  flatCurve('RC', 'R', 'Discount curve'),
  flatCurve('QC', 'Q', 'Dividend curve'),
  {
    id: 'VOL',
    displayName: 'Black volatility',
    kind: {
      case: 'volatility',
      value: {
        dayCounter: act360,
        shape: {
          case: 'constant',
          value: { volatility: { source: { case: 'quoteId', value: 'V' } } },
        },
      },
    },
  },
]

/** The bump HANDLERS.md applies before pricing: spot 100 -> 105. */
export const HANDLERS_SPOT_BUMP = { quoteId: 'S', value: 105.0 }

/** payoff x exercise x underlying x style, priced analytically. */
export const handlersTrade: PriceRequestInit = {
  instrument: {
    kind: {
      case: 'option',
      value: {
        underlyings: [
          {
            spotQuoteId: 'S',
            volatilityId: 'VOL',
            discountCurveId: 'RC',
            dividendCurveId: 'QC',
            process: Underlying_Process.BLACK_SCHOLES_MERTON,
          },
        ],
        payoff: {
          type: Payoff_OptionType.CALL,
          kind: { case: 'plain', value: { strike: 100.0 } },
        },
        exercise: {
          type: Exercise_Type.EUROPEAN,
          dates: [{ form: { case: 'iso', value: HANDLERS_EXPIRY } }],
        },
        style: { case: 'vanilla', value: {} },
      },
    },
  },
  engine: { method: Engine_Method.ANALYTIC },
  results: [ResultKind.NPV, ResultKind.DELTA, ResultKind.GAMMA, ResultKind.VEGA],
}

/** HANDLERS.md, "A session, end to end". */
export const HANDLERS_EXPECTED_NPV = 12.459717
export const HANDLERS_NPV_TOLERANCE = 1e-6
