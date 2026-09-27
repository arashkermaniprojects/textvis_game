extends RefCounted
class_name VerbColors

# Ported from blender_animated.py.reference lines 852-992 (VS dict).
# Only the COLOR component of each verb spec is ported here; the
# direction / trail_length / subject-object reaction intensities live
# in step 8's pulse shader (deferred).
#
# VS_DEFAULT = C_DEFAULT (orange) so every edge gets a color, even when
# the verb is unknown.

const C_DEFAULT   := Color(1.0, 0.55, 0.1)    # orange — neutral
const C_CONTAINS  := Color(1.0, 0.75, 0.2)    # warm yellow — containment
const C_PRODUCES  := Color(1.0, 0.95, 0.4)    # bright gold — creation
const C_TRANSFORM := Color(0.7, 0.5, 1.0)     # violet — transformation
const C_FLOW      := Color(0.2, 0.8, 1.0)     # cyan — flow / feeds
const C_ENABLE    := Color(1.0, 0.65, 0.2)    # amber — enablement
const C_REQUIRE   := Color(0.6, 0.6, 0.9)     # muted blue-grey — dependency
const C_BETTER    := Color(0.3, 1.0, 0.4)     # green — improvement
const C_ATTEND    := Color(1.0, 0.3, 0.9)     # magenta — attention
const C_USE       := Color(1.0, 0.5, 0.3)     # coral — usage
const C_OPPOSE    := Color(1.0, 0.25, 0.2)    # red — opposition
const C_RELATE    := Color(0.9, 0.9, 0.9)     # white — symmetric

# Exact keys from the parent VS dict. Verb strings from world_state.json
# are lowercased, whitespace-stripped, spaces/dashes → underscores before
# lookup.
const VERB_COLORS := {
	# containment
	"contains": C_CONTAINS,
	"consists_of": C_CONTAINS,
	"has": C_CONTAINS,
	"composed_of": C_CONTAINS,
	"includes": C_CONTAINS,
	"part_of": C_CONTAINS,
	"comprises": C_CONTAINS,
	"made_of": C_CONTAINS,
	"built_from": C_CONTAINS,

	# substitution / elimination
	"replaces": C_OPPOSE,
	"eliminates": C_OPPOSE,
	"supersedes": C_OPPOSE,
	"substitutes": C_OPPOSE,
	"removes": C_OPPOSE,
	"avoids": C_OPPOSE,

	# production / creation
	"produces": C_PRODUCES,
	"generates": C_PRODUCES,
	"creates": C_PRODUCES,
	"emits": C_PRODUCES,
	"outputs": C_PRODUCES,
	"yields": C_PRODUCES,
	"introduces": C_PRODUCES,
	"presents": C_PRODUCES,
	"achieves": C_PRODUCES,
	"delivers": C_PRODUCES,
	"provides": C_PRODUCES,
	"gives": C_PRODUCES,
	"showcases": C_PRODUCES,
	"showcase": C_PRODUCES,
	"demonstrates": C_PRODUCES,

	# transformation
	"transforms_into": C_TRANSFORM,
	"transforms": C_TRANSFORM,
	"becomes": C_TRANSFORM,
	"converts_to": C_TRANSFORM,
	"converts": C_TRANSFORM,
	"maps_to": C_TRANSFORM,
	"projects_into": C_TRANSFORM,
	"translates_to": C_TRANSFORM,
	"turns_into": C_TRANSFORM,

	# data flow
	"feeds_into": C_FLOW,
	"flows_to": C_FLOW,
	"passes_to": C_FLOW,
	"streams_to": C_FLOW,
	"propagates_to": C_FLOW,
	"connects_to": C_FLOW,
	"links_to": C_FLOW,
	"sends_to": C_FLOW,

	# enablement
	"enables": C_ENABLE,
	"enable": C_ENABLE,
	"allows": C_ENABLE,
	"allow": C_ENABLE,
	"makes_possible": C_ENABLE,
	"triggers": C_ENABLE,
	"activates": C_ENABLE,
	"supports": C_ENABLE,
	"facilitates": C_ENABLE,

	# dependency
	"requires": C_REQUIRE,
	"depends_on": C_REQUIRE,
	"needs": C_REQUIRE,
	"required_for": C_REQUIRE,
	"relies_on": C_REQUIRE,

	# comparison / superiority
	"outperforms": C_BETTER,
	"better_than": C_BETTER,
	"surpasses": C_BETTER,
	"beats": C_BETTER,
	"exceeds": C_BETTER,
	"improves": C_BETTER,
	"enhances": C_BETTER,
	"refines": C_BETTER,
	"optimizes": C_BETTER,
	"boosts": C_BETTER,
	"strengthens": C_BETTER,

	# attention / focus
	"attends_to": C_ATTEND,
	"focuses_on": C_ATTEND,
	"attends": C_ATTEND,
	"queries": C_ATTEND,
	"caters_to": C_ATTEND,
	"addresses": C_ATTEND,
	"targets": C_ATTEND,

	# usage / operation
	"uses": C_USE,
	"operates_on": C_USE,
	"works_on": C_USE,
	"processes": C_USE,
	"applies_to": C_USE,
	"handles": C_USE,

	# opposition / conflict
	"opposes": C_OPPOSE,
	"conflicts_with": C_OPPOSE,
	"contradicts": C_OPPOSE,
	"differs_from": C_OPPOSE,
	"prevents": C_OPPOSE,
	"blocks": C_OPPOSE,

	# relation (symmetric)
	"relates": C_RELATE,
	"relates_to": C_RELATE,
	"associated_with": C_RELATE,
	"linked_with": C_RELATE,
	"corresponds_to": C_RELATE,
}

static func normalize_verb(verb: String) -> String:
	return verb.strip_edges().to_lower().replace(" ", "_").replace("-", "_")

static func color_for_verb(verb: String) -> Color:
	var key := normalize_verb(verb)
	return VERB_COLORS.get(key, C_DEFAULT)
