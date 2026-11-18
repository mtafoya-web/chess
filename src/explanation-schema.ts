/** Shape constraints supplement, and never replace, the chess evidence validator. */
export const EXPLANATION_SCHEMA = {
    type:'object', additionalProperties:false,
    properties:{
        explanation:{type:'string',maxLength:4200}, lesson:{type:'string',maxLength:800},
        evidenceIds:{type:'array',items:{type:'string'},minItems:1,maxItems:6},
        lineRefs:{type:'array',maxItems:8,items:{type:'object',additionalProperties:false,properties:{branch:{type:'string'},step:{type:'integer',minimum:0}},required:['branch','step']}},
    }, required:['explanation','lesson','evidenceIds'],
};
